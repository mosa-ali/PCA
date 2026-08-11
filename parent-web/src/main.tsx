import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './i18n';
import { applyDocumentDirection } from './i18n';
import i18n from './i18n';
import { AuthProvider } from './state/AuthContext';
import { StepUpProvider } from './state/StepUpContext';
import './styles/global.css';

applyDocumentDirection(i18n.language ?? 'en');
i18n.on('languageChanged', (lng) => applyDocumentDirection(lng));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <StepUpProvider>
          <App />
        </StepUpProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
