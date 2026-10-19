import { icon } from './icons.js';

const ICONS = { success: 'check', error: 'alert', info: 'sparkles' };

export function createToasts(region) {
    return function toast(message, { type = 'info', action = null, timeout = type === 'error' ? 8000 : 4000 } = {}) {
        const element = document.createElement('div');
        element.className = `toast ${type}`;
        element.setAttribute('role', type === 'error' ? 'alert' : 'status');
        element.innerHTML = `${icon(ICONS[type])}<span class="toast-text"></span>`;
        element.querySelector('.toast-text').textContent = message;
        const dismiss = () => {
            element.classList.add('leaving');
            setTimeout(() => element.remove(), 200);
        };
        if (action) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'toast-action';
            button.textContent = action.label;
            button.addEventListener('click', () => { action.onClick(); dismiss(); });
            element.appendChild(button);
        }
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'toast-close';
        close.innerHTML = icon('close');
        close.addEventListener('click', dismiss);
        element.appendChild(close);
        region.appendChild(element);
        if (timeout) setTimeout(dismiss, timeout);
        return dismiss;
    };
}
