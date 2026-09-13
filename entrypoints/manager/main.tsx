import { createRoot } from 'react-dom/client';
import { applyThemeEarly } from '../../components/applyTheme';
import App from './App';
import '../../styles/theme.css';
import './manager.css';

void applyThemeEarly();
createRoot(document.getElementById('root')!).render(<App />);
