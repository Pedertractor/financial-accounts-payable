/** Item do array retornado pelo GET /employee/list da API base (PederTractor) */
export interface ApiBaseEmployeeDesignationSector {
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

export interface ApiBaseEmployeeDesignationPosition {
  id: number;
  value: string;
  name: string;
  normalizedName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiBaseEmployeeDesignation {
  id: number;
  startDate: string;
  endDate: string;
  leader: string;
  sector: ApiBaseEmployeeDesignationSector;
  position: ApiBaseEmployeeDesignationPosition;
  createdAt: string;
  updatedAt: string;
}

export interface ApiBaseEmployeeListItem {
  id: number;
  name: string;
  cardNumber: string;
  unit: 'PEDERTRACTOR' | 'TRACTOR';
  firstEntry: string;
  secondEntry: string;
  firstExit: string;
  secondExit: string;
  status: boolean;
  Designation: ApiBaseEmployeeDesignation[];
  createdAt: string;
  updatedAt: string;
}

/** Resposta do GET /employee/list: array de colaboradores na raiz */
export type ApiBaseEmployeeListResponse = ApiBaseEmployeeListItem[];
