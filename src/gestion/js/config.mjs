// Renseigner ces deux valeurs (Supabase > Project Settings > API) pour passer du mode démo à la vraie base.
// La clé « anon » est publique par conception : la protection vient de la connexion et des règles RLS.
export const CONFIG = {
  SUPABASE_URL: "https://lkxqcmzeidlyssoqmqkh.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxreHFjbXplaWRseXNzb3FtcWtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNzI1MDcsImV4cCI6MjEwODc0ODUwN30.tbal77PSChfoyzNx1-RBRIqgmZbxZY33DHxl7WT8a7U",
  // Clé publique des rappels sur téléphone (Web Push). La clé privée reste dans les secrets de la fonction Supabase.
  VAPID_PUBLIC_KEY: "BO9VT10PvJTFqIFkhxArLQ1qbiuwaZHrYeKdCMhakxaxd7OUDkmAMePSqRHhcKykR2-1Gv_4W4BKGcXFWGxEVS8",
};
