/** Remote shell texture presets — grayscale patterns; theme supplies color. */

export const REMOTE_TEXTURES = [
    { id: 'none', label: 'Flat' },
    { id: 'carbon', label: 'Carbon fiber' },
    { id: 'brushed', label: 'Brushed metal' },
    { id: 'noise', label: 'Fine grain' },
    { id: 'grid', label: 'Tech grid' },
    { id: 'dots', label: 'Halftone dots' },
    { id: 'weave', label: 'Cross weave' }
];

export const DEFAULT_REMOTE_TEXTURE = 'none';

export function normalizeRemoteTexture(value) {
    return REMOTE_TEXTURES.some((t) => t.id === value) ? value : DEFAULT_REMOTE_TEXTURE;
}
