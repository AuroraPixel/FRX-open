import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/tokens.css';
import './ui/base.css';
import { App } from './app';
import { pins } from './lib/params';
import { installPins } from './lib/pinned';
import { forgetOldPage } from './lib/player-data';
import { applySettings, readSettings } from './store/settings';

// Seeded randomness and a standing clock come first, so everything after sees them.
installPins(pins());
// what the old interface left in this browser goes, its theater_ connection keys among it
forgetOldPage();
const light = pins().light;
if (light) document.documentElement.dataset.light = light;
applySettings(readSettings());

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
