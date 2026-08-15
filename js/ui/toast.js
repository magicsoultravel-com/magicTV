let toastHost = null;

export function showAppToast(message, { duration = 2200 } = {}) {
    if (!message) return;

    if (!toastHost) {
        toastHost = document.createElement('div');
        toastHost.id = 'app-toast-host';
        toastHost.className = 'app-toast-host';
        toastHost.setAttribute('aria-live', 'polite');
        toastHost.setAttribute('aria-atomic', 'true');
        document.body.appendChild(toastHost);
    }

    const toast = document.createElement('div');
    toast.className = 'app-toast';
    toast.textContent = message;
    toastHost.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('is-visible'));

    window.setTimeout(() => {
        toast.classList.remove('is-visible');
        window.setTimeout(() => {
            toast.remove();
            if (toastHost && !toastHost.childElementCount) {
                toastHost.remove();
                toastHost = null;
            }
        }, 200);
    }, duration);
}
