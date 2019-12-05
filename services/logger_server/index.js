
/**
 * This is a bit unusual "service" since it isn't actually REST, but
 * just destructively modifies the console.log to winston. Did it this
 * way just to see how far we can push it.
 */

const winston = I.require('winston');
const loggerTransports = {
    console: new winston.transports.Console(),
    file: new winston.transports.File({ filename: "combined.log" })
};
const logger = winston.createLogger({
    level: 'info',
    levels: winston.config.syslog.levels,
    format: winston.format.simple(),
    transports: [
        loggerTransports.file
    ]
});
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

for(let level in winston.config.syslog.levels) {
    console[level] = logger.log.bind(logger, level);
}

// Keeps rough compatibility with console.log
let stdlog = logger.log.bind(logger, 'info');
console.log = (...args) => { stdlog(args.join(' ')); };