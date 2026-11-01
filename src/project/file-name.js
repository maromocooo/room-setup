// The name a project is saved under, without its ".zip".

export const DEFAULT_PROJECT_NAME = 'room-project';

/** A name that is safe as a file name on any system, or '' if nothing usable is left. */
export function cleanProjectName(text) {
    return String(text)
        .trim()
        .replace(/\.zip$/i, '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
        .replace(/^[.\s]+|[.\s]+$/g, '')
        .slice(0, 120);
}

/** The name of an opened file. Drops the " (3)" a browser adds to repeated downloads. */
export function nameFromFile(fileName) {
    const name = String(fileName).replace(/\.zip$/i, '').replace(/\s*[(（]\d+[)）]$/, '');
    return cleanProjectName(name) || DEFAULT_PROJECT_NAME;
}
