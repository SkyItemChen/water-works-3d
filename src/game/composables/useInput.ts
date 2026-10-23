/**
 * Keyboard + pointer input.
 *
 * Keyboard: arrows / WASD to move, X or up to rotate, Space hard drop,
 * Shift hold, R restart, Esc pause, M mute, P toggle preview, 1-3 camera.
 * Touch is handled by TouchControls.vue calling the same `dispatch` actions.
 */

import { onBeforeUnmount, onMounted } from 'vue';
import type { Action } from '../core/engine';

export interface InputHandlers {
  onAction: (a: Action) => void;
  onRestart: () => void;
  onPause: () => void;
  onToggleMute: () => void;
  onTogglePreview: () => void;
  onCamera?: (kind: 'left' | 'right' | 'reset' | 'zoomin' | 'zoomout') => void;
}

export function useInput(handlers: InputHandlers) {
  let enabled = true;

  function setEnabled(v: boolean): void {
    enabled = v;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!enabled) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    let handled = true;
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        handlers.onAction('L');
        break;
      case 'ArrowRight':
      case 'KeyD':
        handlers.onAction('R');
        break;
      case 'ArrowUp':
      case 'KeyX':
      case 'KeyW':
        handlers.onAction('C');
        break;
      case 'ArrowDown':
      case 'KeyS':
        handlers.onAction('D');
        break;
      case 'Space':
        handlers.onAction('A');
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
      case 'KeyC':
        handlers.onAction('H');
        break;
      case 'KeyR':
        handlers.onRestart();
        break;
      case 'Escape':
      case 'KeyP':
        handlers.onPause();
        break;
      case 'KeyM':
        handlers.onToggleMute();
        break;
      case 'KeyV':
        handlers.onTogglePreview();
        break;
      case 'KeyQ':
        handlers.onCamera?.('left');
        break;
      case 'KeyE':
        handlers.onCamera?.('right');
        break;
      case 'Equal':
      case 'NumpadAdd':
        handlers.onCamera?.('zoomin');
        break;
      case 'Minus':
      case 'NumpadSubtract':
        handlers.onCamera?.('zoomout');
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown));

  return { setEnabled };
}
