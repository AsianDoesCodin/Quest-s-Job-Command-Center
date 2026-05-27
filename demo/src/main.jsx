import React from 'react';
import { createRoot } from 'react-dom/client';
import QuestApp from '../QuestCommandCenter.jsx';

import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QuestApp />
  </React.StrictMode>
);
