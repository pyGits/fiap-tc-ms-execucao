import { Db } from "mongodb";

import MensageriaGateway from "../domain/gateway/MensageriaGateway";
import TelemetriaGateway from "../domain/gateway/TelemetriaGateway";
import ExecucaoRepository from "../domain/repository/ExecucaoRepository";
import MensagemProcessadaRepository from "../domain/repository/MensagemProcessadaRepository";

import ExecucaoRepositoryMongo, {
  DocumentoExecucao,
} from "../domain/repository/Mongo/ExecucaoRepositoryMongo";
import MensagemProcessadaRepositoryMongo, {
  DocumentoMensagem,
} from "../domain/repository/Mongo/MensagemProcessadaRepositoryMongo";
import ExecucaoRepositoryMemoria from "../domain/repository/Mock/ExecucaoRepositoryMemoria";
import MensagemProcessadaRepositoryMemoria from "../domain/repository/Mock/MensagemProcessadaRepositoryMemoria";
import MensageriaGatewayMemoria from "../domain/gateway/Mock/MensageriaGatewayMemoria";
import TelemetriaGatewayMemoria from "../domain/gateway/Mock/TelemetriaGatewayMemoria";

import CancelarExecucaoUseCase from "../domain/usecase/Execucao/CancelarExecucaoUseCase";
import EnfileirarExecucaoUseCase from "../domain/usecase/Execucao/EnfileirarExecucaoUseCase";
import OperarExecucaoUseCase from "../domain/usecase/Execucao/OperarExecucaoUseCase";

import RabbitMQMensageriaGateway from "./messaging/RabbitMQMensageriaGateway";
import NewRelicTelemetriaGateway from "./telemetry/NewRelicTelemetriaGateway";

export type Container = {
  execucaoRepository: ExecucaoRepository;
  mensagensProcessadas: MensagemProcessadaRepository;
  mensageria: MensageriaGateway;
  telemetria: TelemetriaGateway;
  enfileirarExecucao: EnfileirarExecucaoUseCase;
  cancelarExecucao: CancelarExecucaoUseCase;
  operarExecucao: OperarExecucaoUseCase;
};

export type OpcoesContainer = {
  db?: Db;
  mensageria?: MensageriaGateway;
  telemetria?: TelemetriaGateway;
};

export function criarContainer(opcoes: OpcoesContainer = {}): Container {
  const usarMongo = Boolean(opcoes.db);

  const execucaoRepository: ExecucaoRepository = opcoes.db
    ? new ExecucaoRepositoryMongo(
        opcoes.db.collection<DocumentoExecucao>("execucoes"),
      )
    : new ExecucaoRepositoryMemoria();

  const mensagensProcessadas: MensagemProcessadaRepository = opcoes.db
    ? new MensagemProcessadaRepositoryMongo(
        opcoes.db.collection<DocumentoMensagem>("mensagens_processadas"),
      )
    : new MensagemProcessadaRepositoryMemoria();

  const mensageria: MensageriaGateway =
    opcoes.mensageria ??
    (usarMongo ? new RabbitMQMensageriaGateway() : new MensageriaGatewayMemoria());

  const telemetria: TelemetriaGateway =
    opcoes.telemetria ??
    (usarMongo ? new NewRelicTelemetriaGateway() : new TelemetriaGatewayMemoria());

  return {
    execucaoRepository,
    mensagensProcessadas,
    mensageria,
    telemetria,
    enfileirarExecucao: new EnfileirarExecucaoUseCase(
      execucaoRepository,
      mensageria,
      telemetria,
    ),
    cancelarExecucao: new CancelarExecucaoUseCase(
      execucaoRepository,
      mensageria,
      telemetria,
    ),
    operarExecucao: new OperarExecucaoUseCase(
      execucaoRepository,
      mensageria,
      telemetria,
    ),
  };
}

export default criarContainer;
