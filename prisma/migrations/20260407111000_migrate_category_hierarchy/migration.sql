ALTER TABLE "Category"
ADD COLUMN "parentId" TEXT;

DROP INDEX "Category_householdId_name_key";

CREATE UNIQUE INDEX "Category_householdId_parentId_type_name_key"
ON "Category"("householdId", "parentId", "type", "name");

ALTER TABLE "Category"
ADD CONSTRAINT "Category_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TEMP TABLE "_CategoryHierarchyMigration" (
    "childId" TEXT PRIMARY KEY,
    "parentId" TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO "_CategoryHierarchyMigration" ("childId", "parentId")
SELECT
    category."id",
    'hier_' || md5(category."id" || ':' || clock_timestamp()::TEXT || ':' || random()::TEXT)
FROM "Category" AS category
WHERE category."parentId" IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM "Category" AS child
      WHERE child."parentId" = category."id"
  );

INSERT INTO "Category" (
    "id",
    "householdId",
    "parentId",
    "name",
    "type",
    "isActive",
    "createdAt",
    "updatedAt"
)
SELECT
    mapping."parentId",
    category."householdId",
    NULL,
    category."name",
    category."type",
    category."isActive",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "_CategoryHierarchyMigration" AS mapping
JOIN "Category" AS category ON category."id" = mapping."childId";

UPDATE "Category" AS category
SET
    "parentId" = mapping."parentId",
    "name" = 'Общее',
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_CategoryHierarchyMigration" AS mapping
WHERE category."id" = mapping."childId";
