
var _ = require('gl519')
var mimeTypes = require('./mimeTypes')
var crypto = require('crypto')
var http = require('http')

function sign(secret, httpVerb, bucket, path, params) {
    // see:
    // http://docs.amazonwebservices.com/AmazonS3/latest/index.html?RESTAuthentication.html
    httpVerb = httpVerb.toUpperCase()
    var date = params["Date"] || ""
    var md5 = params["Content-MD5"] || ""
    var contentType = params["Content-Type"] || ""
    
    var canonicalizedAmzHeaders = []
    _.each(params, function (p, name) {
        if (name.match(/x-amz-/i)) {
            name = name.toLowerCase()
            if (typeof p != "object") p = [p]
            p = _.map(p, function (e) { return e.replace(/\s+/g, ' ') }).sort().join(',')
            canonicalizedAmzHeaders.push(name + ':' + p + '\n')
        }
    })
    canonicalizedAmzHeaders = canonicalizedAmzHeaders.sort().join('')
    
    var canonicalizedResource = '/' + (bucket || "") + (path || "")
    
    var stringToSign = httpVerb + "\n" + md5 + "\n" + contentType + "\n" + date + "\n" + canonicalizedAmzHeaders + canonicalizedResource
    
    return crypto.createHmac('sha1', secret).update(stringToSign).digest('base64')
}

function restCall(id, secret, httpVerb, bucket, path, data, params) {
    if (!params) params = {}
    
    var buffer = (typeof data == "object") ? data : null
    
    params["Date"] = new Date().toUTCString()
    
    if (data) {
        var mimeType = path && mimeTypes[(path.match(/\.([^\.]+)$/) || [])[1]]
        if (mimeType) {
            params["Content-Type"] = mimeType
        }
        params["Content-Length"] = buffer ? data.length : Buffer.byteLength(data, 'utf8')
        params["Content-MD5"] = crypto.createHash('md5').update(data, buffer ? null : 'utf8').digest('base64')
    }
    if (httpVerb.match(/put/i)) {
        params["Content-Length"] = params["Content-Length"] || 0
    }
    
    params["Authorization"] = "AWS " + id + ":" + sign(secret, httpVerb, bucket, path, params)
    
    var req = http.request({
        host : 's3.amazonaws.com',
        method : httpVerb,
        path : '/' + (bucket || "") + (path || ""),
        headers : params
    })
    var p = _.p()
    req.on('response', function (res) {
        _.run(function () {
            p([res.statusCode, _.consume(res)])
        })
    })
    req.end(data, buffer ? null : 'utf8')
    var r = _.p()

    if (Math.floor(r[0] / 100) == 2) return r[1]
    error(r[0] + " : " + r[1])
}

module.exports.s3 = function (id, secret, bucket) {
    this.id = id
    this.secret = secret
    this.bucket = bucket
}

module.exports.s3.prototype.restCall = function (httpVerb, path, data, params) {
    return restCall(this.id, this.secret, httpVerb, this.bucket, path, data, params)
}

module.exports.s3.prototype.del = function (path) {
    return restCall(this.id, this.secret, 'delete', this.bucket, path)
}

module.exports.s3.prototype.get = function (path) {
    return restCall(this.id, this.secret, 'get', this.bucket, path)
}

module.exports.s3.prototype.put = function (path, data, isPublic) {
    var params = null
    if (isPublic) {
        params = {
            'x-amz-acl': 'public-read'
        }
    }
    try {
        restCall(this.id, this.secret, 'put', this.bucket, path, data, params)
    } catch (e) {
        restCall(this.id, this.secret, 'put', this.bucket)
        restCall(this.id, this.secret, 'put', this.bucket, path, data, params)
    }
    return 'http://' + this.bucket + '.s3.amazonaws.com' + path
}
