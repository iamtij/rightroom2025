import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import Admin from './admin/Admin.tsx';
import AmplifyHome from './AmplifyHome.tsx';
import Pass from './pass/Pass.tsx';
import Registration from './register/Registration.tsx';
import './index.css';

const path = window.location.pathname;
const Page = path.startsWith('/admin') ? Admin : path.startsWith('/register') ? Registration : path.startsWith('/pass/') ? Pass : AmplifyHome;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
