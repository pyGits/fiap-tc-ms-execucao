import { Collection } from "mongodb";
import Execucao, { StatusExecucao } from "../../entity/Execucao";
import ServicoExecutavel from "../../entity/ServicoExecutavel";
import ID from "../../vo/ID";
import ExecucaoRepository, { FiltroExecucao } from "../ExecucaoRepository";

// Documento da execucao.
//
// Mesma justificativa do Billing: a execucao e um agregado fechado, lido e
// gravado por inteiro, com a lista de servicos embutida. E tambem o caso de
// uso em que o esquema tende a MUDAR com frequencia (checklists, fotos do
// reparo, apontamentos do mecanico) - um banco de documentos absorve essa
// evolucao sem migration a cada campo novo.
export type DocumentoExecucao = {
  _id: string;
  ordemServicoId: string;
  clienteId: string;
  veiculoId: string;
  sagaId: string;
  status: StatusExecucao;
  posicaoFila: number;
  servicos: Array<{
    referenciaId: string;
    descricao: string;
    tipo: string;
    quantidade: number;
    tempoEstimadoMinutos: number;
    concluido: boolean;
  }>;
  mecanicoResponsavel?: string;
  observacoes?: string;
  motivoCancelamento?: string;
  criadaEm: Date;
  iniciadaEm?: Date;
  finalizadaEm?: Date;
  atualizadaEm: Date;
};

export default class ExecucaoRepositoryMongo implements ExecucaoRepository {
  constructor(private readonly colecao: Collection<DocumentoExecucao>) {}

  async salvar(execucao: Execucao): Promise<void> {
    await this.colecao.insertOne(this.paraDocumento(execucao));
  }

  async atualizar(execucao: Execucao): Promise<void> {
    const { _id, ...campos } = this.paraDocumento(execucao);
    await this.colecao.updateOne({ _id }, { $set: campos }, { upsert: true });
  }

  async obter(id: string): Promise<Execucao | null> {
    const documento = await this.colecao.findOne({ _id: id });
    return documento ? this.hidratar(documento) : null;
  }

  async obterPorOrdemServico(ordemServicoId: string): Promise<Execucao | null> {
    const documento = await this.colecao.findOne(
      { ordemServicoId },
      { sort: { criadaEm: -1 } },
    );
    return documento ? this.hidratar(documento) : null;
  }

  async obterPorSaga(sagaId: string): Promise<Execucao | null> {
    const documento = await this.colecao.findOne(
      { sagaId },
      { sort: { criadaEm: -1 } },
    );
    return documento ? this.hidratar(documento) : null;
  }

  async listar(filtro: FiltroExecucao = {}): Promise<Execucao[]> {
    const consulta: Record<string, unknown> = {};
    if (filtro.status) consulta.status = filtro.status;
    if (filtro.veiculoId) consulta.veiculoId = filtro.veiculoId;

    const documentos = await this.colecao
      .find(consulta)
      .sort({ posicaoFila: 1, criadaEm: 1 })
      .limit(Number(process.env.LIMITE_LISTAGEM || 200))
      .toArray();

    return documentos.map((documento) => this.hidratar(documento));
  }

  async contarNaFila(): Promise<number> {
    return this.colecao.countDocuments({
      status: { $in: [StatusExecucao.NA_FILA, StatusExecucao.EM_ANDAMENTO] },
    });
  }

  private paraDocumento(execucao: Execucao): DocumentoExecucao {
    return {
      _id: execucao.id.getValue(),
      ordemServicoId: execucao.ordemServicoId,
      clienteId: execucao.clienteId,
      veiculoId: execucao.veiculoId,
      sagaId: execucao.sagaId,
      status: execucao.status,
      posicaoFila: execucao.posicaoFila,
      servicos: execucao.servicos.map((servico) => ({
        referenciaId: servico.referenciaId,
        descricao: servico.descricao,
        tipo: servico.tipo,
        quantidade: servico.quantidade,
        tempoEstimadoMinutos: servico.tempoEstimadoMinutos,
        concluido: servico.concluido,
      })),
      mecanicoResponsavel: execucao.mecanicoResponsavel,
      observacoes: execucao.observacoes,
      motivoCancelamento: execucao.motivoCancelamento,
      criadaEm: execucao.criadaEm,
      iniciadaEm: execucao.iniciadaEm,
      finalizadaEm: execucao.finalizadaEm,
      atualizadaEm: execucao.atualizadaEm,
    };
  }

  private hidratar(documento: DocumentoExecucao): Execucao {
    return new Execucao({
      id: new ID(documento._id),
      ordemServicoId: documento.ordemServicoId,
      clienteId: documento.clienteId,
      veiculoId: documento.veiculoId,
      sagaId: documento.sagaId,
      status: documento.status,
      posicaoFila: documento.posicaoFila,
      mecanicoResponsavel: documento.mecanicoResponsavel,
      observacoes: documento.observacoes,
      motivoCancelamento: documento.motivoCancelamento,
      criadaEm: new Date(documento.criadaEm),
      iniciadaEm: documento.iniciadaEm ? new Date(documento.iniciadaEm) : undefined,
      finalizadaEm: documento.finalizadaEm
        ? new Date(documento.finalizadaEm)
        : undefined,
      atualizadaEm: new Date(documento.atualizadaEm),
      servicos: documento.servicos.map(
        (servico) =>
          new ServicoExecutavel({
            referenciaId: servico.referenciaId,
            descricao: servico.descricao,
            tipo: servico.tipo,
            quantidade: servico.quantidade,
            tempoEstimadoMinutos: servico.tempoEstimadoMinutos,
            concluido: servico.concluido,
          }),
      ),
    });
  }
}
