
// idea from http://benanne.net/code/?p=238
function mouseCapture(div, down, move, up) {
    div.mousedown(function (e) {
        e.preventDefault()
        function upWrapper(e) {
            $(document).unbind("mousemove", move)
            $(document).unbind("mouseup", upWrapper)
            up(e)
        }
        $(document).mousemove(move).mouseup(upWrapper)
        down(e)
    })
}

function createCanvas(width, height) {
    if (!width) width = 450
    if (!height) height = 300
    var canvasDiv = $('<div/>').attr({ width : (width + 2) + "px" })
    var canvas = $('<canvas class="canvas">').attr({
        width : width,
        height : height
    })
    canvasDiv.append(canvas)
    var context = canvas.get()[0].getContext("2d")
    
    setTimeout(function () {
        context.beginPath()
        context.rect(0, 0, width, height)
        context.fillStyle = "white"
        context.fill()
    }, 0)
    
    var tools = {
        pencil : {
            size : 5,
            color : 'black'
        },
        eraser : {
            size : 10,
            color : 'white'
        }
    }
    var tool = null
    var strokes = []
    function changeTool(toolName) {
        var newTool = tools[toolName]
        if (tool != newTool) {
            tool = newTool
            strokes.push(tool)
        }
    }
    changeTool("pencil")
    function addStroke(x, y) {
        x -= tool.size / 2
        y -= tool.size / 2
        if (strokes.length > 0) {
            prev = strokes[strokes.length - 1]
            if (prev instanceof Array) {
                context.beginPath()
                context.moveTo(prev[0], prev[1])
                context.lineTo(x, y)
                context.lineWidth = tool.size
                context.strokeStyle = tool.color
                context.stroke()
            }
        }
        context.beginPath()
        context.arc(x, y, tool.size / 2, 0, Math.PI*2)
        context.fillStyle = tool.color
        context.fill()
        strokes.push([x, y])
    }
    function closeStroke() {
        strokes.push(null)
    }
    function clear() {
        context.fillStyle = 'white'; 
        context.fillRect(0, 0, width, height);
        strokes.length = 0
    }
    
    var toolbar = $('<div class="tools" style="width:100%"/>')
    toolbar.append($('<button class="pencil">').text("pencil").click(function () {
        changeTool("pencil")
    }))
    toolbar.append($('<button class="eraser">').text("eraser").click(function () {
        changeTool("eraser")
    }))
    toolbar.append($('<button class="clear">').text("clear").click(function () {
        clear()
    }))
    
    mouseCapture(canvasDiv, function (e) {
        var pos = canvasDiv.position()
        var x = e.pageX - pos.left
        var y = e.pageY - pos.top
        addStroke(x, y)
    }, function (e) {
        var pos = canvasDiv.position()
        var x = e.pageX - pos.left
        var y = e.pageY - pos.top
        addStroke(x, y)
    }, function (e) {
        closeStroke()
    })
    
    var div = $('<div/>')
    div.append(toolbar)
    div.append(canvasDiv)
    
    div.getStrokes = function () {
        return JSON.stringify(strokes)
    }
    
    div.getPng = function () {
        var dataUrl = canvas.get()[0].toDataURL('image/png')
        return dataUrl.substring("data:image/png;base64,".length)
    }
    
    return div
}
