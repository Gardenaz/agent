import pino from "pino";
import pinoPretty from "pino-pretty";

const stream = pinoPretty({
  colorize: true,
  translateTime: "SYS:HH:MM:ss.l",
  ignore: "pid,hostname",
});

export const logger = pino({ level: process.env.LOG_LEVEL ?? "info" }, stream);
