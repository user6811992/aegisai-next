import { h, render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import './styles.css';
import App from './App.jsx';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

render(<App />, document.getElementById('app'));
