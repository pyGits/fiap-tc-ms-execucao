import "dotenv/config";

import criarApp from "./app";
import { criarContainer } from "./container";
import logger from "./logger";
import ComandoConsumer from "./messaging/ComandoConsumer";
import MessageConsumer from "./messaging/MessageConsumer";
import { rabbitMQConnection } from "./messaging/RabbitMQConnection";
import { conectarMongo, fecharMongo } from "./mongo";

const porta = Number(process.env.PORT || 3002);

async function iniciar() {
  const db = await conectarMongo();

  const container = criarContainer({ db });
  const app = criarApp(container);

  const servidor = app.listen(porta, () => {
    logger.info({ porta, servico: "fiap-tc-ms-execucao" }, "aplicacao iniciada");
  });

  const comandoConsumer = new ComandoConsumer(
    {
      enfileirarExecucao: container.enfileirarExecucao,
      cancelarExecucao: container.cancelarExecucao,
    },
    container.mensagensProcessadas,
    new MessageConsumer(),
  );

  try {
    await comandoConsumer.iniciar();
  } catch (erro) {
    logger.error(
      { erro: erro instanceof Error ? erro.message : String(erro) },
      "falha ao iniciar o consumidor de comandos da Saga",
    );
    process.exitCode = 1;
    servidor.close();
    await fecharMongo();
    return;
  }

  const encerrar = async (sinal: string) => {
    logger.info({ sinal }, "encerrando aplicacao");
    servidor.close();
    await rabbitMQConnection.close();
    await fecharMongo();
    process.exit(0);
  };

  process.on("SIGTERM", () => void encerrar("SIGTERM"));
  process.on("SIGINT", () => void encerrar("SIGINT"));
}

if (require.main === module) {
  void iniciar().catch((erro) => {
    logger.error(
      { erro: erro instanceof Error ? erro.message : String(erro) },
      "falha ao iniciar o servico",
    );
    process.exit(1);
  });
}

export { iniciar };
