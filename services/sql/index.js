I.boot = async function boot(name, resid, query, headers, config) {
    let Sequelize = require("sequelize");
    if (typeof config.connection !== "string") {
        return { status: 500 };
    }

    let sequelize = new Sequelize(config.connection);
    let tableArgPat = new RegExp(
        "([\\s]+)(from|update|(insert\\s+into))[\\s]+(([A-Za-z0-9_]+)|(['][^']+['])|([`][^`]+[`]))",
        "gi"
    );

    I.post = async function (name, resid, query, headers, sql) {
        let res = resid.match(/^[/]?([A-Za-z0-9_]+)[/]_query[/]?$/);
        if (!res) {
            return { status: 404 };
        }

        let auth = await I.network(
            "auth",
            "post",
            "/check",
            null,
            headers,
            null
        );
        if (auth.status !== 200) {
            return auth;
        }

        if (!auth.groups || !auth.groups.has("sql:" + res[1])) {
            return { status: 403, body: "Permission denied" };
        }

        try {
            let sqlt = sql.replace(tableArgPat, "$1$2 :table_arg");
            let results = await sequelize.query(sqlt, {
                replacements: { table_arg: res[1], raw: true },
            });
            return { status: 200, body: results };
        } catch (e) {
            return { status: 500, body: e.toString() };
        }

        return { status: 404 };
    };

    I.shutdown = async function (name, resid, query, headers, body) {
        await sequelize.close();
        I.boot = boot;
        I.post = null;
        I.shutdown = null;
        return { status: 200 };
    };

    I.boot = null;
    return { status: 200 };
};
