import { createRoot } from 'react-dom/client';
import '@fontsource/michroma/latin-400.css';
import './styles.css';
import { App } from './App';

// Safari on iOS 26 and later floats its toolbar over the bottom of the page
{
  const ua = navigator.userAgent;
  const version = Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 0);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone;
  if (/iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua) && version >= 26 && !standalone) document.documentElement.classList.add('glass');
}

createRoot(document.getElementById('root')!).render(<App />);
