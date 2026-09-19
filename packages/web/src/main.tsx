import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import { LOCALE, DIR } from './i18n';

// Persian-first document defaults (index.html also declares these; this makes
// the mount robust regardless of the host page).
document.documentElement.lang = LOCALE;
document.documentElement.dir = DIR;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
