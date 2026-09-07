/** Remote keypad button shape presets. */

export const REMOTE_BUTTON_SHAPES = [
    { id: 'circle', label: 'Circle' },
    { id: 'squircle', label: 'Squircle' },
    { id: 'square', label: 'Square' },
    { id: 'ninja', label: 'Ninja' }
];

export const DEFAULT_REMOTE_BUTTON_SHAPE = 'squircle';

export function normalizeRemoteButtonShape(value) {
    return REMOTE_BUTTON_SHAPES.some((s) => s.id === value) ? value : DEFAULT_REMOTE_BUTTON_SHAPE;
}
