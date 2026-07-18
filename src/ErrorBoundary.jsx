import React from 'react';

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    padding: '32px',
                    margin: '40px auto',
                    maxWidth: '800px',
                    backgroundColor: '#1c1917',
                    border: '1px solid #dc2626',
                    borderRadius: '16px',
                    color: '#fca5a5',
                    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
                }}>
                    <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 12px 0', color: '#f87171' }}>
                        Oops! The Editor Crashed
                    </h2>
                    <p style={{ fontSize: '14px', margin: '0 0 20px 0', color: '#d6d3d1' }}>
                        We caught an unhandled runtime exception. Please copy the error message below and paste it back into your chat so we can fix it immediately:
                    </p>
                    <pre style={{
                        padding: '16px',
                        backgroundColor: '#0c0a09',
                        border: '1px solid #292524',
                        borderRadius: '10px',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        fontSize: '13px',
                        color: '#f87171',
                        overflowX: 'auto',
                        whiteSpace: 'pre-wrap',
                        lineHeight: '1.6'
                    }}>
                        <strong>Error:</strong> {this.state.error?.toString()}
                        {"\n\n"}
                        <strong>Stack Trace:</strong>{"\n"}
                        {this.state.error?.stack || 'No stack trace available.'}
                        {"\n\n"}
                        <strong>Component Stack:</strong>{"\n"}
                        {this.state.errorInfo?.componentStack || 'No component stack available.'}
                    </pre>
                    <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                        <button
                            onClick={() => window.location.reload()}
                            style={{
                                padding: '10px 20px',
                                backgroundColor: '#dc2626',
                                hoverBackgroundColor: '#b91c1c',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                fontSize: '14px',
                                transition: 'background-color 0.2s'
                            }}
                        >
                            Reload Editor
                        </button>
                        <button
                            onClick={() => {
                                this.setState({ hasError: false, error: null, errorInfo: null });
                            }}
                            style={{
                                padding: '10px 20px',
                                backgroundColor: '#27272a',
                                color: '#e4e4e7',
                                border: '1px solid #3f3f46',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                fontSize: '14px',
                                transition: 'background-color 0.2s'
                            }}
                        >
                            Try to Recover
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
