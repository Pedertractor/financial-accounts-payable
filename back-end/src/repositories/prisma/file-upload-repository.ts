import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { SourceType, UploadStatus } from '../../generated/prisma/enums.js';

export class FileUploadPrismaRepository {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
  ) {}

  async findById(id: string) {
    return this.prisma.fileUpload.findUnique({
      where: { id },
    });
  }

  async create(data: Prisma.FileUploadCreateInput) {
    return this.prisma.fileUpload.create({ data });
  }

  async updateById(id: string, data: Prisma.FileUploadUpdateInput) {
    return this.prisma.fileUpload.update({
      where: { id },
      data,
    });
  }

  /** Quando o usuário envia um novo arquivo do mesmo tipo, descarta o anterior ainda aguardando confirmação. */
  async cancelAwaitingStagedByRunIdAndSource(
    runId: string,
    sourceType: SourceType,
  ) {
    await this.prisma.fileUpload.updateMany({
      where: {
        runId,
        sourceType,
        status: UploadStatus.AWAITING_CONFIRM,
      },
      data: {
        status: UploadStatus.CANCELLED,
        errorMessage: 'Substituído por nova importação do mesmo tipo.',
        finishedAt: new Date(),
      },
    });
  }

  /** Uploads com processamento encerrado (finishedAt preenchido), do mais recente ao mais antigo. */
  async listRecentFinished(params: { limit: number }) {
    return this.prisma.fileUpload.findMany({
      where: { finishedAt: { not: null } },
      orderBy: { finishedAt: 'desc' },
      take: params.limit,
    });
  }
}
