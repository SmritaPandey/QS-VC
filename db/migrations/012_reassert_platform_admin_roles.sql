-- Reapply the built-in platform-admin roles for databases where migration 005
-- ran before the allowlisted accounts existed or their roles later drifted.
UPDATE users SET role = 'admin', updated_at = NOW()
WHERE lower(email) IN ('services@madylabs.xyz', 'contact@neurqai.com', 'smrita.official@gmail.com')
  AND role <> 'admin';
