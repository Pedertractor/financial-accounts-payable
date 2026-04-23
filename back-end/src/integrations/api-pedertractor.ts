import { env } from '../env/index.js';
import type { $Enums } from '../generated/prisma/client.js';
import { HttpError } from '../http/erros/index.js';
import { ApiBaseEmployeeListResponse } from '../types/apibase-types.js';
import { PedertractorEmployee } from '../types/pedertractor-employee-types.js';

export class ApiPedertractorEmployee {
  async listEmployees(): Promise<ApiBaseEmployeeListResponse> {
    const response = await fetch(`${env.API_PEDERTRACTOR_URL}/employee/get`, {
      method: 'GET',
      headers: {
        nameApplication: env.APPNAME,
        key: env.APPKEY,
      },
    });

    if (response.status !== 200) {
      const message =
        response.status === 500
          ? `Failed to list employees from base API. Status: ${response.status}`
          : `Não foi possível listar colaboradores na API corporativa. Status: ${response.status}`;
      throw new HttpError(message, response.status);
    }

    const data = await response.json();
    const formattedData = Array.isArray(data)
      ? (data as ApiBaseEmployeeListResponse)
      : [];
    return formattedData.filter((employee) => employee.status === true);
  }

  async getEmployee({
    cardNumber,
    unit,
  }: {
    cardNumber: string;
    unit: $Enums.UnitType;
  }): Promise<PedertractorEmployee> {
    const response = await fetch(
      `${env.API_PEDERTRACTOR_URL}/employee/get/${cardNumber}/${unit}`,
      {
        method: 'GET',
        headers: {
          nameapplication: env.APPNAME,
          key: env.APPKEY,
        },
      },
    );

    if (response.status !== 200) {
      const message =
        response.status === 500
          ? `Failed to find employee in base API. Status: ${response.status}`
          : `Não foi possível buscar o colaborador na API corporativa. Status: ${response.status}`;
      throw new HttpError(message, response.status);
    }

    const data = await response.json();
    return data as PedertractorEmployee;
  }
}
