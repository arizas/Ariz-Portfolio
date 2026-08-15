export const modalTemplate = (modalcontent) => /*html*/ `<style>
    :host {
        position: fixed;
        display: flex;
        top:0;
        bottom: 0;
        left: 0;
        right: 0;
        margin: auto;
        z-index: 1000;
        background-color: rgba(255, 255, 255, 0.7);
        /* Allow the overlay itself to scroll if the modal is taller than the
           viewport, so the buttons stay reachable on small/mobile screens. */
        overflow-y: auto;
        padding: 10px;
        box-sizing: border-box;
    }
    .modaldiv {
        margin: auto;
        box-sizing: border-box;
        text-align: center;
        padding: 20px;
        background-color: rgba(0, 0, 0, 0.8);
        border: #4a4 solid 5px;
        color: #4a4;
        font-family: monospace;
        font-size: 20px;
        max-width: 800px;
        /* Keep the modal within the viewport and scroll its own content when
           it does not fit, so buttons at the bottom are always accessible. */
        max-height: 100%;
        overflow-y: auto;
        border-radius: 50px;
    }
    @media (max-height: 700px), (max-width: 600px) {
        .modaldiv {
            padding: 15px;
            font-size: 17px;
            border-radius: 20px;
        }
    }
    button, textarea, select {
        font-family: monospace;
        background-color: #cfc;
        border-color: #4a4;
        border-width: 1px;
        color:#050;
        padding: 10px;
        font-size: 20px;
        
        border-radius: 4px;
        white-space: nowrap;
        
        margin: 2px;
        user-select: none;
    }
    textarea {
        width: 80%;
        height: 80px;
    }
</style>
<div class="modaldiv">
    ${modalcontent}
</div>`;