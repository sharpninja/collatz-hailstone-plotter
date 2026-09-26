export const IOS_INSTALL_HINT = 'Install: Share → Add to Home Screen';
export const SAFARI_INSTALL_HINT = 'Install: File → Add to Dock';

export type InstallUi = 'button' | 'hint' | 'hidden';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function isIos(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/i.test(userAgent)) return true;
  return platform === 'MacIntel' && maxTouchPoints > 1;
}

export function isSafari(userAgent: string): boolean {
  if (!/Safari/i.test(userAgent)) return false;
  return !/Chrome|Chromium|CriOS|FxiOS|Edg|EdgiOS|OPiOS|OPR|Android/i.test(userAgent);
}

export function installHintText(ios: boolean, safari: boolean): string | null {
  if (ios) return IOS_INSTALL_HINT;
  if (safari) return SAFARI_INSTALL_HINT;
  return null;
}

/** Button only when the browser handed us an install prompt. Safari and iOS get a hint instead of a control that cannot call prompt(). */
export function installUi(input: {
  standalone: boolean;
  promptAvailable: boolean;
  ios: boolean;
  safari: boolean;
}): InstallUi {
  if (input.standalone) return 'hidden';
  if (input.promptAvailable) return 'button';
  if (input.ios || input.safari) return 'hint';
  return 'hidden';
}

function isInstallPrompt(event: Event): event is BeforeInstallPromptEvent {
  return typeof (event as BeforeInstallPromptEvent).prompt === 'function';
}

function runningStandalone(target: Window): boolean {
  const nav = target.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some((mode) =>
    target.matchMedia(`(display-mode: ${mode})`).matches,
  );
}

export function watchInstallPrompt(
  target: Window,
  elements: { button: HTMLButtonElement; hint: HTMLElement },
): void {
  const nav = target.navigator;
  const ios = isIos(nav.userAgent, nav.platform, nav.maxTouchPoints);
  const safari = isSafari(nav.userAgent);
  let promptEvent: BeforeInstallPromptEvent | null = null;
  let installed = runningStandalone(target);

  const render = (): void => {
    const mode = installUi({
      standalone: installed || runningStandalone(target),
      promptAvailable: promptEvent !== null,
      ios,
      safari,
    });
    elements.button.hidden = mode !== 'button';
    elements.button.disabled = mode !== 'button';
    if (mode === 'hint') {
      elements.hint.hidden = false;
      elements.hint.textContent = installHintText(ios, safari) ?? '';
    } else {
      elements.hint.hidden = true;
    }
  };

  target.addEventListener('beforeinstallprompt', (event) => {
    if (!isInstallPrompt(event)) return;
    event.preventDefault();
    promptEvent = event;
    render();
  });

  target.addEventListener('appinstalled', () => {
    installed = true;
    promptEvent = null;
    render();
  });

  for (const mode of ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']) {
    target.matchMedia(`(display-mode: ${mode})`).addEventListener('change', render);
  }

  elements.button.addEventListener('click', () => {
    const pending = promptEvent;
    if (!pending) return;
    promptEvent = null;
    elements.button.disabled = true;
    void pending
      .prompt()
      .then(() => pending.userChoice)
      .then((choice) => {
        if (choice.outcome === 'accepted') installed = true;
      })
      .catch(() => {
        // The browser refused the prompt. Another beforeinstallprompt can show the button again.
      })
      .finally(render);
  });

  render();
}

export function registerAppServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  void navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
    .catch(() => {
      // Private mode and some embedded browsers block workers. The plotter still runs.
    });
}
