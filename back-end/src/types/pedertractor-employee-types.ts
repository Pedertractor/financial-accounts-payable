export interface DesignationSector {
  id: string;
  name: string;
  costCenter: string;
  normalizedName: string;
  operationId: number;
  leaderDayId: number;
  leaderNightId: number;
  supervisorDayId: number;
  supervisorNightId: number;
  managerId: number;
  createdAt: string;
  updatedAt: string;
}

export interface DesignationPosition {
  id: number;
  value: string;
  name: string;
  normalizedName: string;
  createdAt: string;
  updatedAt: string;
}

export interface Designation {
  id: number;
  startDate: string;
  endDate: string;
  leader: string;
  sector: DesignationSector;
  position: DesignationPosition;
  createdAt: string;
  updatedAt: string;
}

export interface PedertractorEmployee {
  id: number;
  name: string;
  cardNumber: string;
  unit: string;
  firstEntry: string;
  secondEntry: string;
  firstExit: string;
  secondExit: string;
  status: boolean;
  Designation: Designation[];
  createdAt: string;
  updatedAt: string;
}
