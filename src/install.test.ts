import { describe, expect, it } from 'vitest';
import {
  IOS_INSTALL_HINT,
  SAFARI_INSTALL_HINT,
  installHintText,
  installUi,
  isIos,
  isSafari,
} from './install';

const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1';

describe('install ui', () => {
  it('shows the install button only when a prompt is available', () => {
    expect(installUi({ standalone: false, promptAvailable: true, ios: false, safari: false })).toBe('button');
    expect(installUi({ standalone: false, promptAvailable: false, ios: false, safari: false })).toBe('hidden');
  });

  it('hides the button and the hint after the app is installed', () => {
    expect(installUi({ standalone: true, promptAvailable: true, ios: true, safari: true })).toBe('hidden');
  });

  it('prefers the working button over a hint when both could apply', () => {
    expect(installUi({ standalone: false, promptAvailable: true, ios: true, safari: true })).toBe('button');
  });

  it('shows a home-screen hint on iOS, including Chrome on iPhone', () => {
    expect(isIos(IPHONE, 'iPhone', 5)).toBe(true);
    expect(isIos(CHROME_IOS, 'iPhone', 5)).toBe(true);
    expect(isSafari(CHROME_IOS)).toBe(false);
    expect(installUi({ standalone: false, promptAvailable: false, ios: true, safari: false })).toBe('hint');
    expect(installHintText(true, false)).toBe(IOS_INSTALL_HINT);
    expect(installHintText(true, true)).toBe(IOS_INSTALL_HINT);
  });

  it('shows a dock hint on desktop Safari, which does not fire beforeinstallprompt', () => {
    expect(isSafari(SAFARI_MAC)).toBe(true);
    expect(isSafari(CHROME_MAC)).toBe(false);
    expect(isIos(SAFARI_MAC, 'MacIntel', 0)).toBe(false);
    expect(installUi({ standalone: false, promptAvailable: false, ios: false, safari: true })).toBe('hint');
    expect(installHintText(false, true)).toBe(SAFARI_INSTALL_HINT);
  });

  it('treats iPadOS as an iPhone-style install target', () => {
    expect(isIos(SAFARI_MAC, 'MacIntel', 5)).toBe(true);
    expect(installHintText(true, true)).toBe(IOS_INSTALL_HINT);
  });
});
