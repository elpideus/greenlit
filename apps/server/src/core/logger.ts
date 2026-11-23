import pino from 'pino'

export type Logger = pino.Logger

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    base: undefined,
    redact: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.token'],
    transport: pretty
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        }
      : undefined,
  })
}
