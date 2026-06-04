import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { OwnDesignApp } from '@owndesign/renderer';
import './main.css';

const root = document.getElementById('root');
const apiBaseUrl = import.meta.env.VITE_OWNDESIGN_API_BASE_URL ?? '';

if (!root) {
  throw new Error('Root element not found.');
}

createRoot(root).render(
  <StrictMode>
    <OwnDesignApp apiBaseUrl={apiBaseUrl} />
  </StrictMode>,
);
