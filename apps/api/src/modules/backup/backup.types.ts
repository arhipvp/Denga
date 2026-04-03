export type BackupInfo = {
  id: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
};

export type BackupArtifact = {
  info: BackupInfo;
  filePath: string;
};

export type BackupActor = {
  sub?: string;
  email?: string;
  role?: string;
};
