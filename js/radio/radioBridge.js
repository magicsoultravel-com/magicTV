/**
 * Late-bound radio hooks so mosaic playback/multiView never import RadioModule
 * (avoids MultiView ↔ RadioModule cycles in tests and boot).
 */
export const RadioBridge = {
    /** @type {import('./radioPlayer.js').RadioPlayer | null} */
    player: null,
    /** @type {import('../ui/radioModule.js').RadioModule | null} */
    module: null,

    register({ player = null, module = null } = {}) {
        if (player) this.player = player;
        if (module) this.module = module;
    },

    getPlayer() {
        return this.player;
    },

    getModule() {
        return this.module;
    }
};
