// "Furniture from a photo": image input, engine picker and the job queue.
//
// The engine list comes from the gateway. Picking an engine only records the
// choice; the gateway loads it (and releases any other engine) when a job
// needs it, so switching never requires restarting anything.

import { api } from '../api/client.js';
import { t } from '../core/i18n.js';
import { loadGltfScene, makeFurnitureObject, thumbnailFromBlob } from '../scene/furniture.js';
import { icon } from './icons.js';

const ENGINE_KEY = 'room-setup.engine';
const POLL_ENGINES_MS = 3000;
const POLL_JOB_MS = 1000;

export function setupGenerationPanel({ store, toast, placeFurniture }) {
    const $ = id => document.getElementById(id);
    const dropzone = $('dropzone');
    const input = $('furnitureInput');
    const preview = $('dropPreview');
    const engineList = $('engineList');
    const textureToggle = $('textureToggle');
    const generateButton = $('generate');
    const notice = $('apiNotice');

    let image = null; // { file, url }
    let engines = [];
    let apiState = 'unknown';
    let selected = readSelected();
    let defaultEngine = null;
    let active = false;
    let pollTimer = 0;
    const jobs = new Map(); // local id → job view model

    // ---- image input ----
    dropzone.addEventListener('click', e => { if (!e.target.closest('#dropClear')) input.click(); });
    dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragging'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
    dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('dragging');
        setImage(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { setImage(input.files[0]); input.value = ''; });
    $('dropClear').addEventListener('click', () => setImage(null));

    function setImage(file) {
        if (image) URL.revokeObjectURL(image.url);
        image = null;
        if (file && !file.type.startsWith('image/')) {
            toast(t('toast.invalidImage'), { type: 'error' });
            file = null;
        }
        if (file) image = { file, url: URL.createObjectURL(file) };
        preview.hidden = !image;
        preview.src = image?.url ?? '';
        $('dropEmpty').hidden = Boolean(image);
        $('dropClear').hidden = !image;
        dropzone.classList.toggle('has-image', Boolean(image));
        renderControls();
    }

    // ---- engines ----
    function readSelected() {
        try { return localStorage.getItem(ENGINE_KEY); } catch { return null; }
    }

    function select(id) {
        selected = id;
        try { localStorage.setItem(ENGINE_KEY, id); } catch { /* not persisted */ }
        renderEngines();
        renderControls();
    }

    async function refreshEngines() {
        try {
            const data = await api.engines();
            engines = data.engines;
            defaultEngine = data.default;
            apiState = 'online';
        } catch {
            apiState = 'offline';
        }
        const usable = engines.filter(e => e.configured);
        if (!usable.some(e => e.id === selected)) {
            selected = usable.find(e => e.id === defaultEngine)?.id ?? usable[0]?.id ?? null;
        }
        renderEngines();
        renderControls();
    }

    function engineStatus(engine) {
        if (!engine.configured) return 'unconfigured';
        return engine.state;
    }

    function renderEngines() {
        engineList.replaceChildren(...engines.map(engine => {
            const status = engineStatus(engine);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'engine';
            button.setAttribute('role', 'radio');
            button.setAttribute('aria-checked', String(engine.id === selected));
            button.disabled = !engine.configured;
            button.dataset.status = status;
            button.innerHTML = `
                <span class="engine-radio"></span>
                <span class="engine-text"><strong></strong><small></small></span>
                <span class="status-pill" data-status="${status}"><span class="dot"></span><span class="status-text"></span></span>`;
            button.querySelector('strong').textContent = engine.label;
            button.querySelector('small').textContent = engine.error && status === 'error' ? engine.error : t(`engine.desc.${engine.id}`);
            button.querySelector('.status-text').textContent = t(`engine.state.${status}`);
            button.title = t('engine.switchNote');
            button.addEventListener('click', () => select(engine.id));
            return button;
        }));
        const configured = engines.some(e => e.configured);
        notice.hidden = apiState === 'online' && configured;
        notice.textContent = apiState === 'offline' ? t('api.offline') : t('api.unconfigured');
        notice.dataset.tone = apiState === 'offline' ? 'warning' : 'info';
    }

    function renderControls() {
        const engine = engines.find(e => e.id === selected);
        const optional = engine?.texture === 'optional';
        textureToggle.disabled = !optional;
        if (!optional) textureToggle.checked = Boolean(engine);
        $('textureRow').classList.toggle('disabled', !optional);
        $('textureHint').textContent = t(optional ? 'gen.textureHint.optional' : 'gen.textureHint.always');
        generateButton.disabled = !image || !engine?.configured || apiState !== 'online';
    }

    // ---- jobs ----
    generateButton.addEventListener('click', submit);

    async function submit() {
        const dims = {
            width: Number($('dimWidth').value),
            depth: Number($('dimDepth').value),
            height: Number($('dimHeight').value),
        };
        if (!image) return toast(t('gen.needImage'), { type: 'error' });
        if (!Object.values(dims).every(v => Number.isFinite(v) && v > 0)) return toast(t('gen.badDims'), { type: 'error' });
        const engine = engines.find(e => e.id === selected);
        if (!engine?.configured) return toast(t('gen.noEngine'), { type: 'error' });

        const file = image.file;
        const thumbnail = await thumbnailFromBlob(file).catch(() => null);
        generateButton.disabled = true;
        try {
            const texture = engine.texture === 'optional' && textureToggle.checked;
            const created = await api.createJob({ image: file, engine: engine.id, texture });
            jobs.set(created.id, { ...created, label: engine.label, thumbnail, dims });
            setImage(null);
            renderJobs();
            pollJob(created.id);
            schedulePoll();
        } catch (error) {
            toast(t('job.error', { message: error.message }), { type: 'error' });
        } finally {
            renderControls();
        }
    }

    async function pollJob(id) {
        const local = jobs.get(id);
        if (!local) return;
        try {
            const remote = await api.job(id);
            Object.assign(local, remote);
        } catch (error) {
            if (error.status === 404) Object.assign(local, { status: 'error', error: t('job.lost') });
            else return setTimeout(() => pollJob(id), POLL_JOB_MS * 3);
        }
        renderJobs();
        if (local.status === 'done') return place(local);
        if (local.status !== 'error') setTimeout(() => pollJob(id), POLL_JOB_MS);
    }

    async function place(job) {
        job.status = 'placing';
        renderJobs();
        try {
            const model = await loadGltfScene(job.model_url);
            const object = makeFurnitureObject(model, job.dims);
            const item = placeFurniture({
                id: job.model_id, object, dimensions: job.dims, thumbnail: job.thumbnail, engine: job.engine, modelUrl: job.model_url,
            });
            const warning = job.warning_code === 'texture_failed' ? 'toast.textureFailed'
                : job.warning_code === 'texture_unavailable' ? 'toast.textureUnavailable' : null;
            toast(warning ? t(warning) : t('toast.generated', { name: item.name }), { type: warning ? 'error' : 'success' });
            jobs.delete(job.id);
        } catch (error) {
            console.error(error);
            Object.assign(job, { status: 'error', error: t('toast.loadFailed') });
        }
        renderJobs();
        refreshEngines();
    }

    function jobText(job) {
        if (job.status === 'queued') return t('job.queued', { n: (job.queue_position ?? 0) + 1 });
        if (job.status === 'loading') return t('job.loading', { engine: job.label });
        if (job.status === 'running') return job.stage ? t(`job.stage.${job.stage}`) : t('job.running');
        if (job.status === 'placing') return t('job.placing');
        if (job.status === 'error') return t('job.error', { message: job.error ?? '' });
        return t('job.done');
    }

    function renderJobs() {
        const list = $('jobList');
        $('jobsCard').hidden = jobs.size === 0;
        list.replaceChildren(...[...jobs.values()].map(job => {
            const row = document.createElement('li');
            row.className = 'job';
            row.dataset.status = job.status;
            row.innerHTML = `
                <img class="thumb" alt="">
                <span class="job-text"><strong></strong><small></small></span>
                ${job.status === 'error'
                    ? `<button type="button" class="icon-btn small">${icon('close')}</button>`
                    : '<span class="spinner" aria-hidden="true"></span>'}
                <span class="job-progress"></span>`;
            if (job.thumbnail) row.querySelector('img').src = job.thumbnail;
            row.querySelector('strong').textContent = job.label;
            row.querySelector('small').textContent = jobText(job);
            row.querySelector('button')?.addEventListener('click', () => { jobs.delete(job.id); renderJobs(); });
            row.querySelector('button')?.setAttribute('aria-label', t('job.dismiss'));
            return row;
        }));
    }

    // ---- paste & polling ----
    document.addEventListener('paste', event => {
        if (!active) return;
        const file = [...(event.clipboardData?.files ?? [])].find(f => f.type.startsWith('image/'));
        if (file) {
            event.preventDefault();
            setImage(file);
        }
    });

    function schedulePoll() {
        clearTimeout(pollTimer);
        const busy = [...jobs.values()].some(j => j.status !== 'error');
        if (!active && !busy) return;
        pollTimer = setTimeout(async () => { await refreshEngines(); schedulePoll(); }, POLL_ENGINES_MS);
    }

    function setActive(value) {
        active = value;
        if (value) refreshEngines();
        schedulePoll();
    }

    function relabel() {
        renderEngines();
        renderControls();
        renderJobs();
    }

    refreshEngines();
    return { setActive, relabel, refreshEngines };
}
