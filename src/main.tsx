import './instrument';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import * as Sentry from '@sentry/react';
import Admin from './admin/Admin.tsx';
import AmplifyHome from './AmplifyHome.tsx';
import Pass from './pass/Pass.tsx';
import Registration from './register/Registration.tsx';
import Faq from './Faq.tsx';
import Privacy from './Privacy.tsx';
import Terms from './Terms.tsx';
import './index.css';

const path = window.location.pathname;
const Page = path.startsWith('/admin')
  ? Admin
  : path.startsWith('/register') || path.startsWith('/pay/')
    ? Registration
    : path.startsWith('/pass/')
      ? Pass
      : path.startsWith('/terms')
        ? Terms
        : path.startsWith('/privacy') || path.startsWith('/data-privacy')
          ? Privacy
          : path.startsWith('/faq')
            ? Faq
            : AmplifyHome;

createRoot(document.getElementById('root')!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
