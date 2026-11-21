import { h, render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import './styles.css';
import App from './App.jsx';

// Service worker registration with update detection
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              if (confirm('New version available. Reload?')) window.location.reload();
            }
          });
        }
      });
    }).catch(() => {});
  });
}

try {
  render(<App />, document.getElementById('app'));
} catch (e) {
  console.error('Render error:', e);
  document.getElementById('app').innerHTML = '<pre style="color:red;padding:1rem">' + (e && e.message ? e.message : e) + '</pre>';
}
