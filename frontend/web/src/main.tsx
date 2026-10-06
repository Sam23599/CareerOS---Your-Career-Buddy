import { initializeTheme } from './ui/theme';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './ui/workspace.css';

initializeTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
