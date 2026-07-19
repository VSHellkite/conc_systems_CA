"use strict";

console.log("main.js подключён");

const statusElement = document.getElementById("status");

if (statusElement) {
    statusElement.textContent = "JavaScript conected sucsessfully!";
}