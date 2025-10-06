/**
 * VIB34D Status Management System
 * Handles UI feedback and status messaging
 */

export class StatusManager {
    constructor() {
        this.statusElement = null;
        this.timeout = null;
        this.init();
    }
    
    /**
     * Initialize status system
     */
    init() {
        this.statusElement = document.getElementById('status');
        // Silent handling - status element is optional
    }
    
    /**
     * Set status message with type and auto-clear
     */
    setStatus(message, type = 'info', duration = 3000) {
        if (!this.statusElement) return;
        
        this.statusElement.textContent = message;
        this.statusElement.className = `status ${type}`;
        
        // Clear previous timeout
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        
        // Auto-clear after duration (unless it's an error)
        if (type !== 'error' && duration > 0) {
            this.timeout = setTimeout(() => {
                this.clearStatus();
            }, duration);
        }
        
        // Log to console as well
        const logMethod = type === 'error' ? 'error' : type === 'warning' ? 'warn' : 'log';
        console[logMethod](`[${type.toUpperCase()}] ${message}`);
    }
    
    /**
     * Clear status message
     */
    clearStatus() {
        if (this.statusElement) {
            this.statusElement.textContent = '';
            this.statusElement.className = 'status';
        }
        
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
    }
    
    /**
     * Show success message
     */
    success(message, duration = 3000) {
        this.setStatus(message, 'success', duration);
    }
    
    /**
     * Show error message (persists until cleared)
     */
    error(message) {
        this.setStatus(message, 'error', 0);
    }
    
    /**
     * Show warning message
     */
    warning(message, duration = 4000) {
        this.setStatus(message, 'warning', duration);
    }
    
    /**
     * Show info message
     */
    info(message, duration = 3000) {
        this.setStatus(message, 'info', duration);
    }
    
    /**
     * Show loading message
     */
    loading(message) {
        this.setStatus(message, 'loading', 0);
    }
}
