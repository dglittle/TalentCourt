
function defaultEnv(key, val) {
    if (!process.env[key])
        process.env[key] = val
}
defaultEnv("PORT", 5000)
defaultEnv("HOST", "http://localhost:" + process.env.PORT)
defaultEnv("NODE_ENV", "production")
defaultEnv("MONGOHQ_URL", "mongodb://localhost:27017/talentcourt")
defaultEnv("SESSION_SECRET", "super_secret")

try {
    require('./_config.js')
} catch (e) {}

///

process.on('uncaughtException', function (err) {
    try {
		console.log(err)
        console.log(err.stack)
	} catch (e) {}
})

///

newGlicko = function () {
    var g = { r : 1500, rd : 350 }
    g.min = g.r - g.rd * 3
    g.max = g.r + g.rd * 3
    return g
}

updateGlicko = function (a, b, s) {
    var res = glickoRatingUpdate(a.r, a.rd, b.r, b.rd, s)
    
    a.r = res[0]
    a.rd = Math.max(res[1], 30)
    a.min = a.r - a.rd * 3
    a.max = a.r + a.rd * 3
    
    b.r = res[2]
    b.rd = Math.max(res[3], 30)
    b.min = b.r - b.rd * 3
    b.max = b.r + b.rd * 3
}

// s = 1 if I win, 0 if they win, 0.5 if we tie.
// returns an array with new values
// for myR, myRD, theirR, theirRD
glickoRatingUpdate = function (myR, myRD, theirR, theirRD, s) {
    var pi2 = Math.PI * Math.PI
    var q = Math.log(10) / 400
    var q2 = q * q
    
    function helper(myR, myRD, theirR, theirRD, s) {
        var myRD2 = myRD * myRD
        var theirRD2 = theirRD * theirRD
        var g = 1 / Math.sqrt(1 + 3 * q2 * theirRD2 / pi2)
        var g2 = g * g
        var E = 1 / (1 + Math.pow(
            10, g * (myR - theirR) / -400))
        var d2 = 1 / (q2 * g2 * E * (1 - E))
        var temp = 1 / (1 / myRD2 + 1 / d2)
        return [
            myR + q * temp * g * (s - E),
            Math.sqrt(temp)
        ]
    }
    var a = helper(myR, myRD, theirR, theirRD, s)
    var b = helper(theirR, theirRD, myR, myRD, 1 - s)
    return a.concat(b)
}

///

var _ = require('gl519')
_.run(function () {

    var maxFlags = 2

    function error(msg) {
        throw new Error(msg)
    }

    function getUniqueKey() {
        return _.randomString(10)
    }

    function newObj(kind, props) {
        var o = {
            _id : getUniqueKey(),
            kind : kind,
            time : _.time(),
            random : Math.random()
        }
        if (props)
            _.merge(o, props)
        _.p(db.collection('objs').insert(o, _.p()))
        return o
    }

    function getObj(key, kind) {
        if (!key) return
        var o = _.p(db.collection('objs').findOne({ _id : key }, _.p()))
        if (!o)
            error('object not found: ' + key)
        if (o.kind != kind)
            error('expected "' + kind + '" object, but got "' + o.kind + '" instead')
        return o
    }

    function createTalentCourt(ns, newPrompt, getEntryData, getUser) {
        
        function getGameUserData(u) {
            return _.ensure(u, ns, {})
        }
        
        function getVoteKey(u, es) {
            return u._id + ":" + [es[0]._id, es[1]._id].sort().join(':') 
        }
        
        function mayVote(u, es) {
            return es[0] && es[1] && (es[0]._id != es[1]._id) && (es[0].user != u._id) && (es[1].user != u._id) &&
                !_.p(db.collection('objs').findOne({ _id : getVoteKey(u, es) }, _.p()))
        }
        
        function submitVote(u, es, x) {
            if (!mayVote(u, es))
                error("You may not vote between these entries: perhaps you created one of the entries, or you already voted between them.")
            
            var v = newObj("vote", {
                _id : getVoteKey(u, es),
                game : ns,
                user : u._id,
                entries : _.map(es, function (e) { return e._id }),
                x : x
            })
            
            if (x != 0.5) {
                updateGlicko(es[0].glicko, es[1].glicko, 1 - x)
                _.each(es, function (e) {
                    _.p(db.collection('objs').update({ _id : e._id }, {
                        $set : { glicko : e.glicko },
                        $inc : { voteCount : 1 }
                    }, _.p()))
                })
            }
        
            return v
        }
        
        function setFlag(u, e, flag) {
            if (flag) {
                _.p(db.collection('objs').update({
                    _id : e._id,
                    flags : { $nin : [u._id] }
                }, {
                    $push : { flags : u._id },
                    $inc : { flagCount : 1 }
                }, _.p()))
            } else {
                _.p(db.collection('objs').update({
                    _id : e._id,
                    flags : { $in : [u._id] }
                }, {
                    $pull : { flags : u._id },
                    $inc : { flagCount : -1 }
                }, _.p()))
            }
        }
        
        function getStartedEntry(u) {
            return getGameUserData(u).startedEntry
        }
        
        function startEntry(u) {
            var ud = getGameUserData(u)
            if (ud.startedEntry && _.time() < ud.startedEntry.deadline)
                return ud.startedEntry
            
            var p = newPrompt()
            return ud.startedEntry = {
                prompt : p,
                deadline : _.time() + p.timeLimit
            }
        }
        
        function submitEntry(u, data) {
            var ud = getGameUserData(u)
            if (_.time() >= ud.startedEntry.deadline)
                error("I'm afraid the deadline has passed.")
            
            var e = newObj("entry", {
                game : ns,
                user : u._id,
                prompt : ud.startedEntry.prompt,
                data : data,
                glicko : newGlicko(),
                flags : [],
                flagCount : 0,
                voteCount : 0
            })
            delete ud.startedEntry
            return e
        }
        
        function pickVote(u) {
            function pickOne() {
                db.collection('objs').ensureIndex({ game : 1, kind : 1, random : 1 }, { background : true })
                return _.p(db.collection('objs').find({
                    game : ns,
                    kind : 'entry',
                    random : { $gt : Math.random() },
                    user : { $ne : u._id }
                }).sort({ random : 1 }).limit(1, _.p()))[0]
            }

            for (var t = 0; t < 20; t++) {
                var es = [pickOne(), pickOne()]
                if (mayVote(u, es)) {
                    return es
                }
            }
        }
        
        /////////////////////////////////////////////////////////////
        
        return function (u, q) {
            var ud = getGameUserData(u)
            
            var o = {}
            o.game = ns
            o.user = u
            
            if (q.func == "setFlag") {
                setFlag(u, getObj(q.entry, "entry"), q.flag)
            }
            
            if (q.func == "pickVote") {
                o.kind = "vote"
                var es = pickVote(u)
                if (es) {
                    o.entries = es
                }
            }
            if (q.func == "vote") {
                submitVote(u, _.map(q.entries, function (e) { return getObj(e, "entry") }), q.x)
            }
            
            if (q.func == "confirmCompete") {
                o.kind = "confirmCompete"
            }
            if (q.func == "compete") {
                o.kind = "compete"
                o.entry = startEntry(u)
                o.serverTime = _.time()
            }
            if (q.func == "submit") {
                submitEntry(u, getEntryData(q, ud.startedEntry.prompt))
            }
            
            if (q.func == "view") {
                var targetUser = getObj(q.user, 'user')
                var targetEntry = getObj(q.entry, 'entry')
                var sortBy = q.sortBy || "time"
                if (sortBy == 'rating') sortBy = 'glicko.min'
                var start = q.start || 0
                var end = q.end || (start + 10)

                var E, E_length
                if (targetEntry) {
                    E = [targetEntry]
                    E_length = 1
                } else {
                    var query = {
                        game : ns,
                        kind : 'entry'
                    }
                    if (targetUser)
                        query.user = targetUser._id

                    var index = { game : 1, kind : 1 }
                    var sorter = _.object([[sortBy, -1]])
                    _.merge(index, sorter)
                    db.collection('objs').ensureIndex(index, { background : true })

                    E = _.p(db.collection('objs').find(query).sort(sorter).skip(start).limit(end - start).toArray(_.p()))

                    E_length = _.p(db.collection('objs').find(query).count(_.p()))
                }

                _.parallel(_.map(E, function (e) {
                    return function () {
                        e.user = getObj(e.user, 'user')
                    }
                }))
                
                o.kind = "view"
                o.targetUser = targetUser
                o.entry = targetEntry
                o.sortBy = sortBy
                o.total = E_length
                o.start = start
                o.end = end
                o.entries = _.map(E, function (e) {
                    ee = e
                    ee.flaggedByMe = (e.flags.indexOf(u._id) >= 0)
                    return ee
                })
            }
            
            return o
        }
    }

    /////////////////////////////////////////////////////////////////////

    var gameHandlers = {}

    ;(function () {
        function newPrompt() {
            require('./wordlist.js')
            return {
                text : _.shuffle(writingWordList).slice(0, 3).join(" "),
                timeLimit : 300000,
                textMin : 2,
                textMax : 200
            }
        }
        
        function getEntryData(q, p) {
            var text = q.text
            
            if (text.length < p.textMin || text.length > p.textMax)
                error("invalid text, must be within " + p.textMin + " and " + p.textMax + " characteres")
            
            _.each(p.text.split(/ /), function (word) {
                if (!text.match(new RegExp(_.escapeRegExp(word), 'i')))
                    error("invalid text, must contain the word \"" + word + "\"")
            })
            
            return {
                text : text
            }
        }
        
        gameHandlers['writing'] = createTalentCourt('writing', newPrompt, getEntryData)
    })();

    ;(function () {
        function newPrompt() {
            var words = require('./drawingWordlist.js')
            var word = _.sample(words)
            return {
                text : word,
                timeLimit : 5 * 60 * 1000
            }
        }
        
        var mongodb = require('mongodb')

        function getEntryData(q, p) {
            var id = _.randomString(10)
            var data = {
                png : 'pngs/' + id + '.png',
                strokes : 'strokes/' + id + '.json'
            }
            _.parallel([
                function () {
                    _.p(db.collection('pngs').insert({
                        _id : id,
                        data : mongodb.Binary(new Buffer(q.png, 'base64'))
                    }))
                },
                function () {
                    _.p(db.collection('strokes').insert({
                        _id : id,
                        data : q.strokes
                    }))
                }
            ])
            return data
        }
        
        gameHandlers['drawing'] = createTalentCourt('drawing', newPrompt, getEntryData)
    })();

    ///

    var db = require('mongojs').connect(process.env.MONGOHQ_URL, ['users'])

    var express = require('express')
    var app = express()
    
    _.serveOnExpress(express, app)

    app.use(express.cookieParser())
    app.use(function (req, res, next) {
        _.run(function () {
            req.body = _.consume(req)
            next()
        })
    })

    var MongoStore = require('connect-mongo')(express)
    app.use(express.session({
        secret : process.env.SESSION_SECRET,
        cookie : { maxAge : 10 * 365 * 24 * 60 * 60 * 1000 },
        store : new MongoStore({
            url : process.env.MONGOHQ_URL,
            auto_reconnect : true,
            clear_interval : 3600
        })
    }))

    app.use(function (req, res, next) {
        _.run(function () {
            if (!req.session.user) {
                req.user = newObj('user', {
                    name : _.randomString(1, /[A-Z]/) + _.randomString(4, /[a-z]/)
                })
                req.session.user = req.user._id
            } else {
                req.user = getObj(req.session.user, 'user')
            }
            next()
        })
    })

    var g_rpc_version = 1

    app.get('/', function (req, res) {
        res.cookie('rpc_version', g_rpc_version, { httpOnly: false})
        res.cookie('rpc_token', _.randomString(10), { httpOnly: false})
        res.sendfile('./index.html')
    })

    app.get('/canvas.js', function (req, res) {
        res.sendfile('./canvas.js')
    })

    app.get('/throbber.gif', function (req, res) {
        res.sendfile('./throbber.gif')
    })

    var rpc = {}
    app.all(/\/rpc\/([^\/]+)\/([^\/]+)/, function (req, res, next) {
        _.run(function () {
            try {
                if (g_rpc_version != req.params[0])
                    throw new Error('version mismatch')
                if (!req.cookies.rpc_token || req.cookies.rpc_token != req.params[1])
                    throw new Error('token mismatch')
                var input = _.unJson(req.method.match(/post/i) ? req.body : _.unescapeUrl(req.url.match(/\?(.*)/)[1]))
                function runFunc(input) {
                    return rpc[input.func].apply(null, [input.arg, req, res])
                }
                if (input instanceof Array)
                    var output = _.map(input, runFunc)
                else
                    var output = runFunc(input)
                var body = _.json(output) || "null"
                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Length': Buffer.byteLength(body)
                })
                res.end(body)
            } catch (e) {
                next(e)
            }
        })
    })

    rpc.main = function (arg, req) {
        var u = req.user
        if (arg.post && (arg.post.game in gameHandlers)) {
            gameHandlers[arg.post.game](u, arg.post)
        }
        var ret
        if (arg.q && (arg.q.game in gameHandlers)) {
            ret = gameHandlers[arg.q.game](u, arg.q)
        } else {
            ret = {
                kind : "choose",
                user : u
            }
        }
        _.p(db.collection('objs').update({ _id : u._id }, u, _.p()))
        return ret
    }

    app.get(/\/pngs\/(.*?)\.png/, function (req, res) {
        _.run(function () {
            res.contentType('image/png')
            res.end(_.p(db.collection('pngs').findOne({ _id : req.params[0] }, _.p())).data.buffer, 'binary')
        })
    })

    app.get(/\/strokes\/(.*?)\.json/, function (req, res) {
        _.run(function () {
            res.contentType('application/json')
            res.end(_.p(db.collection('strokes').findOne({ _id : req.params[0] }, _.p())).data)
        })
    })

    app.use(express.errorHandler({
        dumpExceptions: true,
        showStack: true
    }))

    app.listen(process.env.PORT, function() {
        console.log("go to " + process.env.HOST)
    })

})
