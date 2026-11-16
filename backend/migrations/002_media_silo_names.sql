-- Migration 002: Add 'cover', 'random' to media_category and 'listo' to content_scope
ALTER TYPE media_category ADD VALUE IF NOT EXISTS 'cover';
ALTER TYPE media_category ADD VALUE IF NOT EXISTS 'random';
ALTER TYPE content_scope ADD VALUE IF NOT EXISTS 'listo';
