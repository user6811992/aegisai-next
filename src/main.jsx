import { h, render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import './styles.css';
import App from './App.jsx';

// Service worker temporarily disabled for debugging
// if ('serviceWorker' in navigator) {
//   window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
// }

try {
  render(<App />, document.getElementById('app'));
} catch (e) {
  console.error('Render error:', e);
  document.getElementById('app').innerHTML = '<pre style="color:red;padding:1rem">' + (e && e.message ? e.message : e) + '</pre>';
}
