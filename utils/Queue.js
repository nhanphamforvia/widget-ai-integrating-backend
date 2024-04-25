class Queue {
    constructor() {
        this.items = []; // Initialize an empty array to store queue elements
    }

    enqueue(item) {
        // Add an item to the end of the queue
        this.items.push(item);
    }

    dequeue() {
        // Remove and return the item from the front of the queue
        if (this.isEmpty()) {
            throw new Error("Queue is empty");
        }
        return this.items.shift();
    }

    peek() {
        // Get the front element without removing it
        if (this.isEmpty()) {
            throw new Error("Queue is empty");
        }
        return this.items[0];
    }

    isEmpty() {
        // Check whether the queue is empty
        return this.items.length === 0;
    }

    printQueue() {
        // Print the elements present in the queue
        return this.items;
    }
}

module.exports = Queue 

