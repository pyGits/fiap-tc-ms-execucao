import path from "path";
import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "FIAP Tech Challenge - Execucao Service",
      version: "1.0.0",
      description: [
        "Microsservico de Execucao dos servicos na oficina.",
        "",
        "E um PARTICIPANTE da Saga: recebe ENFILEIRAR_EXECUCAO (e a compensacao",
        "CANCELAR_EXECUCAO) pela fila saga.execucao.comandos e responde em",
        "saga.os.reply.",
        "",
        "A conclusao do reparo acontece DEPOIS do fim da Saga - ela leva horas",
        "ou dias - e e comunicada como EVENTO (EXECUCAO_FINALIZADA), ao qual o",
        "OS Service reage. Este servico nao conhece orcamento, pagamento nem o",
        "banco de nenhum outro microsservico.",
      ].join("\n"),
    },
    servers: [{ url: "/", description: "Servidor atual" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        Erro: {
          type: "object",
          properties: {
            erro: {
              type: "object",
              properties: {
                codigo: { type: "string", example: "execucao.fila.cheia" },
                descricao: {
                  type: "string",
                  example: "Fila da oficina cheia (20/20).",
                },
              },
            },
          },
        },
      },
    },
  },
  // O glob do swagger-jsdoc exige barras normais, inclusive no Windows; sem a
  // normalizacao a lista de rotas volta vazia em desenvolvimento local.
  apis: [
    path.join(__dirname, "routes", "*.js").split(path.sep).join("/"),
    path.join(__dirname, "routes", "*.ts").split(path.sep).join("/"),
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
export default swaggerSpec;
