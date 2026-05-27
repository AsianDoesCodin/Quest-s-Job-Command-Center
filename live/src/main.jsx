import React from 'react';
import { createRoot } from 'react-dom/client';
import QuestApp from '../QuestCommandCenter.jsx';
import { supabase } from './lib/supabase';

import './styles.css';

void supabase;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QuestApp />
  </React.StrictMode>
);
