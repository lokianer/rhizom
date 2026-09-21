// Files inside the vault, uploading one, and what a resync reports.
import { Type } from '@sinclair/typebox';

export const AssetSummarySchema = Type.Object(
  {
    path: Type.String(),
    size: Type.Integer(),
    modifiedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'AssetSummary' },
);

export const UploadResponseSchema = Type.Object({
  path: Type.String({ description: 'Vault path of the stored file' }),
});

export const SyncResultSchema = Type.Object({
  added: Type.Integer(),
  updated: Type.Integer(),
  removed: Type.Integer(),
  unchanged: Type.Integer(),
});
