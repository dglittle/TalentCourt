
/*

db.talentcourt
    objs
    _drawing/_writing
        entries
        votes

all objs
    key
    kind
    time

user
    name
    _drawing/_writing
        startedEntry
            prompt
                text
                ...
                timeLimit
            deadline

entry
    user
    prompt
        text
        ...
        timeLimit
    data
        text
        or
        strokes
        png
    glicko
        r
        rd
        time
    _flags
    flagCount
    voteCount

vote
    user
    entries
    x // 0 = entries[0] wins, 1 = entries[1] wins, 0.5 tie (or skip)
    
flag
    user
    entry

*/

var maxFlags = 2

var ns = "talentcourt"
var db = ensure(global.db, ns, {})
if (!db.version || db.version < 1) {
    db.objs = {}
    db.version = 1
}
var commonDb = db

function myRegister(path, func) {
    register('/' + ns + path, func)
}

function getUniqueKey(o) {
    var key = randomIdentifier(4)
    while (key in o)
        key += randomIdentifier(2)
    return key
}

function newObj(kind) {
    var key = getUniqueKey(db.objs)
    var o = {
        key : key,
        kind : kind,
        time : now
    }
    return db.objs[key] = o
}

function getObj(key, kind) {
    if (!key) return
    var o = db.objs[key]
    if (!o)
        error('object not found: ' + key)
    if (o.kind != kind)
        error('expected "' + kind + '" object, but got "' + o.kind + '" instead')
    return o
}

function getUser(q) {
    if (!q.session) error('error.. maybe your cookies are disabled?')
    var u = getObj(ensure(q.session, ns, {}).userKey, 'user')
    if (!u) {
        u = newObj('user')
        u.name = randomIdentifier(1, "ABCDEFGHIJKLMNOPQRSTUVWXYZ") + randomIdentifier(4, "abcdefghijklmnopqrstuvwxyz")
        q.session[ns].userKey = u.key
    }
    return u
}

function pruneCopy(o, depth) {
    function helper(o, depth) {
        if ((typeof(o) == "object") && o) {
            if (depth <= 0)
                return "too deep"
            var oo = {}
            foreach(o, function (e, k) {
                if (typeof(k) == "string" && k.match(/^_/))
                    return
                oo[k] = helper(e, depth - 1)
            })
            return oo
        } else {
            return o
        }
    }
    return helper(o, depth)
}

function createTalentCourt(ns, newPrompt, getEntryData, getUser) {
    var db = ensure(commonDb, ns, {})
    ensure(db, "entries", {})
    ensure(db, "votes", {})
    
    function getGameUserData(u) {
        return ensure(u, '_' + ns, {})
    }
    
    function getVoteKey(u, es) {
        return u.key + ":" + [es[0].key, es[1].key].sort().join(':') 
    }
    
    function mayVote(u, es) {
        return (es[0] != es[1]) && (es[0].user != u) && (es[1].user != u) &&
            !db.votes[getVoteKey(u, es)]
    }
    
    function submitVote(u, es, x) {
        if (!mayVote(u, es))
            error("You may not vote between these entries: perhaps you created one of the entries, or you already voted between them.")
        
        var v = newObj("vote")
        v.user = u
        v.entries = es
        v.x = x
        db.votes[getVoteKey(u, es)] = v
        
        if (x != 0.5) {
            updateGlicko(es[0].glicko, es[1].glicko, 1 - x)
            foreach(es, function (e) { e.voteCount++ })
        }
    
        return v
    }
    
    function setFlag(u, e, flag) {
        if (flag) {
            if (e._flags[u.key]) {
                error("You have already flagged this entry.")
            }
            
            var v = newObj("flag")
            v.user = u
            v.entry = e
            
            e._flags[u.key] = v
            e.flagCount += 1
            
        } else {
            var v = e._flags[u.key]
            if (!v) {
                error("You haven't flagged this entry.")
            }
            delete e._flags[u.key]
            e.flagCount -= 1
        }
    }
    
    function getStartedEntry(u) {
        return getGameUserData(u).startedEntry
    }
    
    function startEntry(u) {
        var ud = getGameUserData(u)
        if (ud.startedEntry && now < ud.startedEntry.deadline)
            return ud.startedEntry
        
        var p = newPrompt()
        return ud.startedEntry = {
            prompt : p,
            deadline : now + p.timeLimit
        }
    }
    
    function submitEntry(u, data) {
        var ud = getGameUserData(u)
        if (now >= ud.startedEntry.deadline)
            error("I'm afraid the deadline has passed.")
        
        var e = newObj("entry")
        e.user = u
        e.prompt = ud.startedEntry.prompt
        e.data = data
        e.glicko = newGlicko()
        e._flags = {}
        e.flagCount = 0
        e.voteCount = 0
        
        delete ud.startedEntry
        
        return db.entries[e.key] = e
    }
    
    function pickVote(u) {
        var E = []
        foreach(db.entries, function (e) {
            if (!e._flags[u.key] && e.flagCount <= maxFlags) {
                if (e.user != u) {
                    E.push(e)
                }
            }
        })
        E.sort(function (a, b) { return a.voteCount - b.voteCount })
        
        var n = E.length
        for (var t = 0; t < 20; t++) {
            var i1 = Math.floor(20 * Math.random()) % n
            var i2 = Math.floor(n * Math.random())
            
            var e1 = E[i1]
            var e2 = E[i2]
            
            var es = [e1, e2]
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
        o.user = pruneCopy(u, 1)
        
        if (q.func == "setFlag") {
            setFlag(u, getObj(q.entry, "entry"), q.flag)
        }
        
        if (q.func == "pickVote") {
            o.kind = "vote"
            var es = pickVote(u)
            if (es) {
                o.entries = map(es, function (e) { return pruneCopy(e, 2) })
            }
        }
        if (q.func == "vote") {
            submitVote(u, map(q.entries, function (e) { return getObj(e, "entry") }), q.x)
        }
        
        if (q.func == "confirmCompete") {
            o.kind = "confirmCompete"
        }
        if (q.func == "compete") {
            if (u.guest) error("must be logged in to compete")
            o.kind = "compete"
            o.entry = pruneCopy(startEntry(u), 2)
            o.serverTime = time()
        }
        if (q.func == "submit") {
            if (u.guest) error("must be logged in to compete")
            submitEntry(u, getEntryData(q, ud.startedEntry.prompt))
        }
        
        if (q.func == "view") {
            var targetUser = getObj(q.user, 'user')
            var targetEntry = getObj(q.entry, 'entry')
            var sortBy = q.sortBy || "time"
            var start = q.start || 0
            var end = q.end || (start + 10)
            
            var E = []
            if (targetEntry) {
                E.push(targetEntry)
            } else {
                foreach(db.entries, function (e) {
                    if (!targetUser || (targetUser == e.user)) {
                        if (e.flagCount <= maxFlags) {
                            E.push(e)
                        }
                    }
                })
                if (sortBy == "time") {
                    E.sort(function (a, b) {
                        return b.time - a.time
                    })
                } else if (sortBy == "rating") {
                    E.sort(function (a, b) {
                        return b.glicko.min - a.glicko.min
                    })
                }
            }
            
            o.kind = "view"
            o.targetUser = pruneCopy(targetUser, 1)
            o.entry = pruneCopy(targetEntry, 2)
            o.sortBy = sortBy
            o.total = E.length
            o.start = start
            o.end = end
            o.entries = map(E.slice(start, end), function (e) {
                ee = pruneCopy(e, 2)
                ee.flaggedByMe = (u.key in e._flags)
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
        require('./wordlist')
        return {
            text : shuffle(writingWordList).slice(0, 3).join(" "),
            timeLimit : 300000,
            textMin : 2,
            textMax : 200
        }
    }
    
    function getEntryData(q, p) {
        var text = q.text
        
        if (text.length < p.textMin || text.length > p.textMax)
            error(sprintf("invalid text, must be within %d and %d characteres", p.textMin, p.textMax))
        
        foreach(p.text.split(/ /), function (word) {
            if (!text.match(new RegExp(escapeRegex(word), 'i')))
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
        var words = require('./drawingWordlist')
        var word = words[randomIndex(words.length)]
        return {
            text : word,
            timeLimit : 5 * 60 * 1000
        }
    }
    
    function getEntryData(q, p) {
        var data = {}
        var id = randomIdentifier(20)
        data.strokes = s3.put('/strokes/' + id + '.json', q.strokes, true)
        data.png = s3.put('/sketches/' + id + '.png', new Buffer(q.png, 'base64'), true)
        return data
    }
    
    gameHandlers['drawing'] = createTalentCourt('drawing', newPrompt, getEntryData)
})();

registerRe('/talentcourt.*', function (q) {
    return {
        code : 302,
        'Content-Type' : true,
        Location : 'http://' + config.host + '/talentcourt'
    }
})

myRegister('', function () {
    return getStaticFile('./servlets/talentcourt.html')
})

myRegister('/main', function (q) {
    var u = getUser(q)
    if (q.post) {
        var qq = unJson(q.post)
        if (qq && (qq.game in gameHandlers)) {
            gameHandlers[qq.game](u, qq)
        }
    }
    if (q.q) {
        var qq = unJson(q.q)
        if (qq && (qq.game in gameHandlers)) {
            return gameHandlers[qq.game](u, qq)
        }
    }
    return {
        kind : "choose",
        user : pruneCopy(u, 1)
    }
})

