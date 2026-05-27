import { supabase } from './supabase';

export const LIVE_COLLECTIONS = {
  jobs: 'app_jobs',
  team: 'app_team_members',
  timelog: 'app_time_entries',
  expenses: 'app_expenses',
  messages: 'app_messages',
};

const collectionEntries = Object.entries(LIVE_COLLECTIONS);

const readCollection = async (collection, table) => {
  const { data, error } = await supabase
    .from(table)
    .select('id,data,updated_at')
    .order('updated_at', { ascending: false });

  if (error) throw error;

  return [
    collection,
    (data || []).map((row) => ({
      ...(row.data && typeof row.data === 'object' ? row.data : {}),
      id: row.data?.id || row.id,
    })),
  ];
};

export const loadLiveData = async () => {
  const loaded = await Promise.all(
    collectionEntries.map(([collection, table]) => readCollection(collection, table))
  );

  return Object.fromEntries(loaded);
};

export const upsertEntity = async (collection, entity) => {
  const table = LIVE_COLLECTIONS[collection];
  if (!table) throw new Error(`Unknown live data collection: ${collection}`);
  if (!entity?.id) throw new Error(`Cannot save ${collection} item without an id.`);

  const { error } = await supabase
    .from(table)
    .upsert({
      id: String(entity.id),
      data: entity,
    });

  if (error) throw error;
};

export const deleteEntity = async (collection, id) => {
  const table = LIVE_COLLECTIONS[collection];
  if (!table) throw new Error(`Unknown live data collection: ${collection}`);
  if (!id) throw new Error(`Cannot delete ${collection} item without an id.`);

  const { error } = await supabase
    .from(table)
    .delete()
    .eq('id', String(id));

  if (error) throw error;
};

export const isMissingLiveTablesError = (error) => {
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return message.includes('could not find the table')
    || message.includes('schema cache')
    || message.includes('relation')
    || error?.code === '42P01'
    || error?.code === 'PGRST205';
};
