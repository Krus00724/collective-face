import { createRoot } from 'react-dom/client';
import '@fontsource/michroma/latin-400.css';
import './styles.css';
import { App } from './App';
import { watchScreen } from './services/screen';

watchScreen();

createRoot(document.getElementById('root')!).render(<App />);
