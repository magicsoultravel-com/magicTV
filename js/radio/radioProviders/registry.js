import { RadioBrowserProvider } from './radioBrowser.js';
import { PROVIDER_RADIO_BROWSER } from '../stationShape.js';
import { loadRadioState, patchRadioState } from '../radioState.js';

const PROVIDERS = {
    [PROVIDER_RADIO_BROWSER]: RadioBrowserProvider
};

export const RadioProviderRegistry = {
    getActiveId() {
        return loadRadioState().catalogProvider || PROVIDER_RADIO_BROWSER;
    },

    getActive() {
        return PROVIDERS[this.getActiveId()] || RadioBrowserProvider;
    },

    setActive(providerId) {
        const id = PROVIDERS[providerId] ? providerId : PROVIDER_RADIO_BROWSER;
        patchRadioState({ catalogProvider: id });
        return id;
    },

    get(providerId) {
        return PROVIDERS[providerId] || RadioBrowserProvider;
    }
};
